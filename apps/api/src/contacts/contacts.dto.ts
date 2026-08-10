import { Type } from 'class-transformer';
import { IsArray, IsEmail, IsIn, IsOptional, IsString, Length, ValidateNested } from 'class-validator';
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
