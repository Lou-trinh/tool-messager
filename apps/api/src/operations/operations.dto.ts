import { IsArray, IsDateString, IsIn, IsInt, IsObject, IsOptional, IsString, Length, MaxLength, Min } from 'class-validator';

export class CreateTemplateDto {
  @IsString() @Length(2, 100) name!: string;
  @IsString() @Length(1, 10_000) content!: string;
  @IsOptional() @IsArray() @IsString({ each: true }) variables?: string[];
}

export class UpdateTemplateDto {
  @IsOptional() @IsString() @Length(2, 100) name?: string;
  @IsOptional() @IsString() @Length(1, 10_000) content?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) variables?: string[];
  @IsOptional() @IsIn(['ACTIVE', 'ARCHIVED']) status?: 'ACTIVE' | 'ARCHIVED';
}

export class CreateAutomationDto {
  @IsString() @Length(2, 120) name!: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsString() @Length(2, 80) triggerType!: string;
  @IsOptional() @IsObject() triggerConfig?: Record<string, unknown>;
  @IsString() @Length(2, 80) actionType!: string;
  @IsOptional() @IsObject() actionConfig?: Record<string, unknown>;
}

export class SetAutomationStatusDto {
  @IsIn(['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED']) status!: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
}

export class CreatePostDto {
  @IsString() accountId!: string;
  @IsOptional() @IsString() @MaxLength(200) title?: string;
  @IsString() @Length(1, 20_000) content!: string;
  @IsIn(['ZALO', 'FACEBOOK', 'TIKTOK']) platform!: 'ZALO' | 'FACEBOOK' | 'TIKTOK';
  @IsOptional() @IsString() @MaxLength(200) idempotencyKey?: string;
}

export class SchedulePostDto {
  @IsDateString() scheduledAt!: string;
  @IsOptional() @IsString() @MaxLength(100) timezone?: string;
}

export class CreateProxyDto {
  @IsString() @Length(2, 100) name!: string;
  @IsIn(['HTTP', 'HTTPS', 'SOCKS5']) type!: 'HTTP' | 'HTTPS' | 'SOCKS5';
  @IsString() @Length(1, 255) host!: string;
  @IsInt() @Min(1) port!: number;
  @IsOptional() @IsString() username?: string;
  @IsOptional() @IsString() password?: string;
}
