import { Type } from 'class-transformer';
import { IsArray, IsEmail, IsIn, IsObject, IsOptional, IsString, Length, ValidateNested } from 'class-validator';
import type { ImportMapping } from './import-engine.service';
import { consentStatusSchema, platformSchema, type ConsentStatus, type Platform } from '@omni/shared';

export class ContactInputDto {
  @IsIn(platformSchema.options)
  platform!: Platform;

  @IsOptional()
  @IsString()
  platformUserId?: string;

  @IsString()
  @Length(1, 160)
  displayName!: string;

  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsString()
  @Length(2, 120)
  source!: string;

  @IsIn(consentStatusSchema.options)
  consentStatus!: ConsentStatus;

  @IsOptional()
  @IsString()
  consentSource?: string;
}

export class ImportContactsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContactInputDto)
  contacts!: ContactInputDto[];
}

export class ImportMappingDto {
  @IsObject()
  mapping!: ImportMapping;
}

export class UpdateConsentDto {
  @IsIn(consentStatusSchema.options)
  status!: ConsentStatus;

  @IsString()
  @Length(2, 120)
  source!: string;

  @IsOptional()
  @IsString()
  legalBasis?: string;
}

export class CreateTagDto {
  @IsString()
  @Length(1, 50)
  name!: string;

  @IsOptional()
  @IsString()
  color?: string;
}

export class CreateSuppressionDto {
  @IsOptional()
  @IsIn(platformSchema.options)
  platform?: Platform;

  @IsOptional()
  @IsString()
  platformUserId?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsString()
  @Length(2, 240)
  reason!: string;

  @IsString()
  @Length(2, 120)
  source!: string;
}

export class SegmentInputDto {
  @IsString()
  @Length(1, 80)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsObject()
  filter!: {
    search?: string;
    platform?: Platform;
    consentStatus?: ConsentStatus;
    suppressed?: boolean;
    tagId?: string;
    source?: string;
  };
}

export class BulkContactActionDto {
  @IsArray()
  @IsString({ each: true })
  contactIds!: string[];

  @IsIn(['TAG', 'ARCHIVE', 'SUPPRESS', 'OPT_IN', 'OPT_OUT'])
  operation!: 'TAG' | 'ARCHIVE' | 'SUPPRESS' | 'OPT_IN' | 'OPT_OUT';

  @IsOptional()
  @IsString()
  tagId?: string;
}
