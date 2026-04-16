import { IsString, IsNotEmpty } from 'class-validator';

/**
 * POST /hubs/:id/assign-nm
 * Assign a supplier (NM) to a hub. Populates both nm_id=0 placeholder and nm_code
 * (real reference used by M13/M16 for lead_time_days lookup via supplier_code).
 */
export class AssignHubNmDto {
  @IsString()
  @IsNotEmpty()
  nmCode: string;
}
