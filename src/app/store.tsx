import { create } from 'zustand';

export interface Album {
    id: string;
    title: string;
    productUrl: string;
    isWriteable: boolean;
    shareInfo: {
        sharedAlbumOptions: {
            isCollaborative: boolean;
            isCommentable: boolean;
        };
        shareableUrl: string;
        shareToken: string;
        isJoined: boolean;
        isOwned: boolean;
        isJoinable: boolean;
    };
    mediaItemsCount: string;
    coverPhotoBaseUrl: string;
    coverPhotoMediaItemId: string;
}

export const useAlbumStore = create(() => ({ albums: [] }) as { albums: Array<Album> });