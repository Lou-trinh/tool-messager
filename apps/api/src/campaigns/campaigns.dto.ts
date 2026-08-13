import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDate, IsOptional, IsString, Length } from 'class-validator';

export class CreateCampaignDto {
  @IsString()
  @Length(2, 150)
  name!: string;

  @IsString()
  accountId!: string;

  @IsString()
  templateId!: string;

  @IsArray()
  @IsOptional()
  @ArrayMinSize(1)
  @ArrayMaxSize(50_000)
  @IsString({ each: true })
  contactIds?: string[];

  @IsOptional()
  @IsString()
  segmentId?: string;

  @IsOptional()
  @IsBoolean()
  promotional?: boolean;
}

export class ScheduleCampaignDto {
  @Type(() => Date)
  @IsDate()
  scheduledAt!: Date;
}
