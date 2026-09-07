/** Client-safe public Live comment shape (no Ably server imports). */
export type LiveCommentPublic = {
  id: string;
  body: string;
  createdAt: string;
  commenter: {
    id: string;
    username: string | null;
    name: string;
    photo: string;
  };
};
