export type CategoryOut = {
  id: string;
  slug: string;
  title: string;
  place: string;
  description: string;
  position: number;
  hidden: boolean;
  photoCount: number;
  selectedCount: number;
  live: boolean;
  coverUrl: string | null;
};

export type TextStatus = "needs_text" | "approved";

export type PhotoOut = {
  id: string;
  categoryId: string;
  slug: string | null;
  title: string;
  alt: string;
  description: string;
  textStatus: TextStatus;
  selected: boolean;
  position: number;
  originalName: string;
  width: number;
  height: number;
  source: "upload" | "migration" | "google-photos";
  createdAt: string;
  previewUrl: string;
};

export type CategoryInput = { title: string; place: string; description: string; slug?: string };
export type CategoryPatch = Partial<{ title: string; place: string; description: string; hidden: boolean }>;

