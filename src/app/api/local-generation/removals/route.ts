import {localRemovalGET,localRemovalPOST} from '@/modules/model-providers/local/removal-service';
export const runtime='nodejs';
export const maxDuration=30;
export const GET=localRemovalGET;
export const POST=localRemovalPOST;
