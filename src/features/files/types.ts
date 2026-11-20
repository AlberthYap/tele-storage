export type FileInfo = {
  id: string;
  fileName: string;
  fileType: string | null;
  mimeType: string | null;
  fileSize: number;
  categoryId: string | null;
  caption: string | null;
  eventDate: string | null;
  isFavorite: boolean;
  createdAt: Date;
};

export type FileDetail = FileInfo & {
  tags: { id: string; name: string }[];
};

export type ServiceError =
  | { code: "NOT_FOUND"; message: string }
  | { code: "TELEGRAM_ERROR"; message: string }
  | { code: "CONFLICT"; message: string }
  | { code: "INTERNAL"; message: string };

export type ServiceResult<T> = { ok: true; value: T } | { ok: false; error: ServiceError };
