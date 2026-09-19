// StundTransfer: deposit mode for reverse share links (see STUNDTRANSFER.md).
import { Module } from "@nestjs/common";
import { ReverseShareModule } from "src/reverseShare/reverseShare.module";
import { DepositController } from "./deposit.controller";
import { DepositService } from "./deposit.service";

@Module({
  imports: [ReverseShareModule],
  controllers: [DepositController],
  providers: [DepositService],
})
export class StundTransferModule {}
