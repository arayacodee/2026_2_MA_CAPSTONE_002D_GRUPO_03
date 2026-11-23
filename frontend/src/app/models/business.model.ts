import { BusinessCategory, AttentionMode } from './business-category';
export interface BusinessOwner {
  id: string;
  email: string;
  name: string | null;
  role: 'CLIENT' | 'PROFESSIONAL' | 'SUPERADMIN';
}

export interface Business {
  canBook?: boolean;
  isArchived?: boolean;
  category?: BusinessCategory;
  professionalName?: string | null;
  specialties?: string | null;
  address?: string | null;
  attentionMode?: AttentionMode | null;
  id: string;
  name: string;
  description: string | null;
  timezone: string;
  avatarUrl: string | null;
  avatarPublicId: string | null;
  coverUrl: string | null;
  coverPublicId: string | null;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  owner?: BusinessOwner;
}

export interface BusinessProfileRequest {
  category?: BusinessCategory;
  professionalName?: string | null;
  specialties?: string | null;
  address?: string | null;
  attentionMode?: AttentionMode | null;
}
export interface CreateBusinessRequest extends BusinessProfileRequest {
  name: string;
  description?: string;
}

export interface UpdateBusinessRequest extends BusinessProfileRequest {
  name?: string;
  description?: string | null;
}
