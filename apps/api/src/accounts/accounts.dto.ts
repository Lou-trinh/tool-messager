import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { platformSchema, type Platform } from '@omni/shared';

export class CreateAccountDto {
  @IsIn(platformSchema.options)
  platform!: Platform;

  @IsString()
  @Length(1, 255)
  platformAccountId!: string;

  @IsString()
  @Length(1, 150)
  displayName!: string;

  @IsOptional()
  @IsString()
  username?: string;
}
