// StundTransfer: HTTP API for deposits.
// Uploader routes are protected by the reverse share token (start) and then by
// the deposit secret sent in the "x-deposit-secret" header.
import {
  Body,
  Controller,
  Delete,
  ExecutionContext,
  Get,
  Headers,
  HttpCode,
  Injectable,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import { SkipThrottle, Throttle } from "@nestjs/throttler";
import { User } from "@prisma/client";
import { Request } from "express";
import { GetUser } from "src/auth/decorator/getUser.decorator";
import { JwtGuard } from "src/auth/guard/jwt.guard";
import { DepositService } from "./deposit.service";
import { AddDepositFilesDTO, CreateDepositDTO } from "./dto/deposit.dto";

const SECRET_HEADER = "x-deposit-secret";
// Chunks sent with this type are streamed to disk instead of being buffered in memory
const STREAM_CHUNK_TYPE = "application/x-stundtransfer-chunk";

/** Signed-in users only (JwtGuard alone lets anonymous users through when anonymous shares are allowed). */
@Injectable()
export class SignedInGuard extends JwtGuard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    await super.canActivate(context);
    return !!context.switchToHttp().getRequest().user;
  }
}

@Controller("stundtransfer")
export class DepositController {
  constructor(private depositService: DepositService) {}

  @Get("guest")
  @Throttle({ default: { limit: 30, ttl: 60 * 1000 } })
  getGuestLink() {
    return this.depositService.getGuestLink();
  }

  @Get("links/:token")
  @Throttle({ default: { limit: 30, ttl: 60 * 1000 } })
  getLink(@Param("token") token: string) {
    return this.depositService.getLinkInfo(token);
  }

  @Post("deposits")
  @Throttle({ default: { limit: 10, ttl: 60 * 1000 } })
  create(@Body() body: CreateDepositDTO) {
    return this.depositService.createDeposit(body);
  }

  @Post("deposits/:id/files")
  @SkipThrottle()
  addFiles(
    @Param("id") id: string,
    @Headers(SECRET_HEADER) secret: string,
    @Body() body: AddDepositFilesDTO,
  ) {
    return this.depositService.addFiles(id, secret, body);
  }

  @Get("deposits/:id")
  getDeposit(
    @Param("id") id: string,
    @Headers(SECRET_HEADER) secret: string,
  ) {
    return this.depositService.getDeposit(id, secret);
  }

  @Put("deposits/:id/files/:fileId/chunks/:index")
  @SkipThrottle()
  uploadChunk(
    @Param("id") id: string,
    @Param("fileId") fileId: string,
    @Param("index", ParseIntPipe) index: number,
    @Headers(SECRET_HEADER) secret: string,
    @Req() request: Request,
  ) {
    if (request.headers["content-type"] === STREAM_CHUNK_TYPE)
      return this.depositService.writeChunk(
        id,
        fileId,
        index,
        secret,
        request,
        parseInt(request.headers["content-length"] ?? "", 10),
      );
    // application/octet-stream: already parsed by the raw body parser of main.ts
    const data = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
    return this.depositService.writeChunk(id, fileId, index, secret, data);
  }

  @Post("deposits/:id/complete")
  @HttpCode(202)
  complete(
    @Param("id") id: string,
    @Headers(SECRET_HEADER) secret: string,
  ) {
    return this.depositService.complete(id, secret);
  }

  @Delete("deposits/:id")
  cancel(
    @Param("id") id: string,
    @Headers(SECRET_HEADER) secret: string,
  ) {
    return this.depositService.cancelByUploader(id, secret);
  }

  // Admin side: owners of deposit links (and admins) see the deposits history.

  @Get("admin/deposits")
  @UseGuards(SignedInGuard)
  list(@GetUser() user: User) {
    return this.depositService.listForAdmin(user);
  }

  @Get("admin/deposits/:id")
  @UseGuards(SignedInGuard)
  get(@Param("id") id: string, @GetUser() user: User) {
    return this.depositService.getForAdminWithFiles(id, user);
  }

  @Post("admin/deposits/:id/retry")
  @HttpCode(202)
  @UseGuards(SignedInGuard)
  retry(@Param("id") id: string, @GetUser() user: User) {
    return this.depositService.retry(id, user);
  }

  @Delete("admin/deposits/:id")
  @UseGuards(SignedInGuard)
  remove(@Param("id") id: string, @GetUser() user: User) {
    return this.depositService.remove(id, user);
  }
}
