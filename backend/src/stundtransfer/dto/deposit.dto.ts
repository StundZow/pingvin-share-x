// StundTransfer: request bodies of the deposit API.
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from "class-validator";
import {
  STUND_MAX_FILES,
  STUND_MAX_FILES_PER_BATCH,
} from "../stundtransfer.config";

export class CreateDepositDTO {
  @IsString()
  @Length(1, 200)
  token: string;

  @IsString()
  @Length(1, 200)
  uploaderName: string;

  @IsString()
  @Length(1, 200)
  videoName: string;

  @IsInt()
  @Min(1)
  @Max(STUND_MAX_FILES)
  fileCount: number;

  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  totalSize: number;
}

export class DepositFileDTO {
  // Relative path as seen by the browser, e.g. "Card A/CLIP/A001.MP4"
  @IsString()
  @Length(1, 4096)
  path: string;

  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  size: number;

  // File "date modified", in milliseconds
  @IsOptional()
  @IsInt()
  @Min(0)
  lastModified?: number;
}

export class AddDepositFilesDTO {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(STUND_MAX_FILES_PER_BATCH)
  @ValidateNested({ each: true })
  @Type(() => DepositFileDTO)
  files: DepositFileDTO[];
}
