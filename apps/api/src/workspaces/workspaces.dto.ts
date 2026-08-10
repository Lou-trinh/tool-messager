import { IsEmail, IsIn, IsString, Length } from 'class-validator';
import { roles, type WorkspaceRole } from '@omni/auth';

export class CreateWorkspaceDto {
  @IsString()
  @Length(2, 100)
  name!: string;
}

export class InviteMemberDto {
  @IsEmail()
  email!: string;

  @IsIn(roles)
  role!: WorkspaceRole;
}
