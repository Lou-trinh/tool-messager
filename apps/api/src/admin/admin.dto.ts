import { IsBoolean, IsDateString, IsEmail, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min, MinLength } from 'class-validator';

const planCodes = ['FREE', 'BASIC', 'PRO', 'BUSINESS', 'ENTERPRISE'] as const;

export class CreateTenantDto {
  @IsString() @Length(2, 120) companyName!: string;
  @IsString() @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) tenantSlug!: string;
  @IsString() @Length(2, 100) ownerName!: string;
  @IsEmail() ownerEmail!: string;
  @IsString() @MinLength(12) @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).+$/) temporaryPassword!: string;
  @IsIn(planCodes) plan!: typeof planCodes[number];
  @IsDateString() startDate!: string;
  @IsDateString() expirationDate!: string;
  @IsOptional() @IsInt() @Min(0) maxAccounts?: number;
  @IsOptional() @IsInt() @Min(0) maxContacts?: number;
  @IsOptional() @IsInt() @Min(0) maxMessages?: number;
}

export class UpdateTenantDto {
  @IsOptional() @IsString() @Length(2, 120) companyName?: string;
  @IsOptional() @IsString() timezone?: string;
}

export class ChangePlanDto {
  @IsIn(planCodes) plan!: typeof planCodes[number];
  @IsOptional() @IsInt() @Min(0) maxAccounts?: number;
  @IsOptional() @IsInt() @Min(0) maxContacts?: number;
  @IsOptional() @IsInt() @Min(0) maxMessagesPerMonth?: number;
}

export class ExtendSubscriptionDto {
  @IsDateString() expirationDate!: string;
  @IsOptional() @IsBoolean() autoRenew?: boolean;
}

export class ResetTenantPasswordDto {
  @IsString() @MinLength(12) @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).+$/) temporaryPassword!: string;
}

export class SupportSessionDto {
  @IsString() @Length(5, 500) reason!: string;
  @IsOptional() @IsInt() @Min(5) @Max(240) durationMinutes?: number;
}

export class EmergencyStopDto {
  @IsString() @Length(5, 500) reason!: string;
}

export class GlobalSuppressionDto {
  @IsOptional() @IsIn(['ZALO', 'FACEBOOK', 'TIKTOK']) platform?: 'ZALO' | 'FACEBOOK' | 'TIKTOK';
  @IsOptional() @IsString() platformUserId?: string;
  @IsOptional() @IsString() phone?: string;
  @IsString() @Length(2, 240) reason!: string;
}

export class UpsertPlanDto {
  @IsString() @Length(2, 80) name!: string;
  @IsOptional() @IsString() @Length(0, 500) description?: string;
  @IsInt() @Min(0) monthlyPriceCents!: number;
  @IsInt() @Min(0) maxZaloAccounts!: number;
  @IsInt() @Min(1) maxUsers!: number;
  @IsInt() @Min(0) maxContacts!: number;
  @IsInt() @Min(0) maxCampaigns!: number;
  @IsInt() @Min(0) maxMessagesPerDay!: number;
  @IsInt() @Min(0) maxMessagesPerMonth!: number;
  @IsInt() @Min(0) maxStorageBytes!: number;
  @IsBoolean() automationEnabled!: boolean;
  @IsBoolean() analyticsEnabled!: boolean;
  @IsBoolean() apiEnabled!: boolean;
  @IsOptional() @IsBoolean() active?: boolean;
}
