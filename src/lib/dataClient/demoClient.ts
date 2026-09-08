import type { InputList, PressKit, Setlist, Song, SongList } from '../../types';
import type {
  AdminInvitesClient,
  AdminUsersClient,
  AuthClient,
  BandAttachmentsClient,
  BandScopedCrudClient,
  BandsClient,
  BandTrashClient,
  DataClient,
  PressKitImagesClient,
  PressKitSharesClient,
  PublicPressKitsClient,
  PublicRidersClient,
} from './types';
import * as store from '../demo/demoStore';
import { delay } from '../demo/demoStore';

/**
 * Client-side-only `DataClient` implementation used by the static demo build
 * (`VITE_DEMO=true`, see `npm run build:demo`). Backs onto `demoStore`, an in-memory store
 * seeded with sample data and persisted to `localStorage` — no network calls, no real server.
 */

function crudClient<T extends { id: string }>(crud: {
  list(bandId: string): T[];
  create(bandId: string, item: T): T;
  update(bandId: string, item: T): T;
  remove(bandId: string, id: string): void;
}): BandScopedCrudClient<T> {
  return {
    list: (bandId) => delay(crud.list(bandId)),
    create: (bandId, item) => delay(crud.create(bandId, item)),
    update: (bandId, item) => delay(crud.update(bandId, item)),
    remove: (bandId, id) => delay(crud.remove(bandId, id)).then(() => undefined),
  };
}

const bandsClient: BandsClient = {
  list: () => delay(store.listBands()),
  create: async () => {
    throw new Error('Creating additional bands is disabled in the demo.');
  },
  update: (id, input) => {
    const band = store.getDemoBand();
    if (id !== band.id) throw new Error('Band not found.');
    Object.assign(band, input);
    return delay(band);
  },
  remove: async () => {
    throw new Error('Deleting the demo band is disabled in the demo.');
  },
  createInviteLink: (bandId) => {
    const band = store.getDemoBand();
    if (bandId !== band.id) throw new Error('Band not found.');
    return delay({
      inviteId: 'demo-invite',
      inviteUrl: `${window.location.origin}${window.location.pathname}#/invite/demo-invite`,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });
  },
  acceptInvite: () => delay(store.getDemoBand()),
  removeMember: async () => {
    throw new Error('Managing members is disabled in the demo.');
  },
};

const authClient: AuthClient = {
  getCurrentUser: () => delay(store.getDemoUser()),
  onAuthStateChanged(callback) {
    let cancelled = false;
    void delay(store.isDemoSignedIn() ? store.getDemoUser() : null).then((user) => {
      if (!cancelled) callback(user);
    });
    return () => {
      cancelled = true;
    };
  },
  login: () => {
    store.setDemoSignedIn(true);
    return delay({ user: store.getDemoUser(), error: null });
  },
  getInvite: () => delay({ invite: null, error: 'Invites are disabled in the demo.' }),
  acceptInvite: () => {
    store.setDemoSignedIn(true);
    return delay({ user: store.getDemoUser(), error: null });
  },
  logout: async () => {
    store.setDemoSignedIn(false);
    store.resetDemoStore();
    await delay(undefined);
  },
  updateEmail: (email) => {
    const user = { ...store.getDemoUser(), email };
    return delay({ user, error: null });
  },
  updateUsername: (username) => {
    const user = { ...store.getDemoUser(), username };
    return delay({ user, error: null });
  },
  updateFullName: (fullName) => {
    const user = { ...store.getDemoUser(), fullName };
    return delay({ user, error: null });
  },
  updatePassword: () => delay({ error: null }),
  deleteAccount: async () => {
    store.resetDemoStore();
    return delay({ error: null });
  },
};

const publicRidersClient: PublicRidersClient = {
  get: (bandId, riderId) => delay(store.getPublicRider(bandId, riderId)),
};

const publicPressKitsClient: PublicPressKitsClient = {
  get: (token) => delay(store.getPublicPressKit(token)),
};

const bandAttachmentsClient: BandAttachmentsClient = {
  list: (bandId, songId) => delay(store.listAttachments(bandId, songId)),
  upload: (bandId, songId, file) => delay(store.addAttachment(bandId, songId, file)),
  rename: (bandId, songId, attachmentId, name) =>
    delay(store.renameAttachment(bandId, songId, attachmentId, name)).then(() => undefined),
  remove: (bandId, songId, attachmentId) =>
    delay(store.removeAttachment(bandId, songId, attachmentId)).then(() => undefined),
};

const bandTrashClient: BandTrashClient = {
  list: (bandId) => delay(store.listTrash(bandId)),
  restore: (bandId, trashId) => delay(store.restoreTrash(bandId)(trashId)),
  remove: (bandId, trashId) => delay(store.removeTrashPermanently(bandId)(trashId)),
  empty: (bandId) => delay(store.emptyTrash(bandId)),
};

const bandPressKitImagesClient: PressKitImagesClient = {
  list: (bandId) => delay(store.listPressKitImages(bandId)),
  upload: (bandId, file, thumbnail) => delay(store.addPressKitImage(bandId, file, thumbnail)),
  remove: (bandId, imageId) => delay(store.removePressKitImage(bandId, imageId)).then(() => undefined),
};

const bandPressKitSharesClient: PressKitSharesClient = {
  get: (bandId, kitId) => delay(store.getPressKitShare(bandId, kitId)),
  create: (bandId, kitId) => delay(store.createPressKitShare(bandId, kitId)),
  disable: (bandId, kitId) => delay(store.disablePressKitShare(bandId, kitId)).then(() => undefined),
};

// The demo user is never an admin, and admin routes are gated behind that in the UI —
// these only need to satisfy the type contract, not do anything useful.
const adminInvitesClient: AdminInvitesClient = {
  list: () => delay([]),
  create: async () => {
    throw new Error('Admin actions are disabled in the demo.');
  },
  revoke: async () => {
    throw new Error('Admin actions are disabled in the demo.');
  },
};

const adminUsersClient: AdminUsersClient = {
  list: () => delay([]),
  setQuota: async () => {
    throw new Error('Admin actions are disabled in the demo.');
  },
  setRole: async () => {
    throw new Error('Admin actions are disabled in the demo.');
  },
  remove: async () => {
    throw new Error('Admin actions are disabled in the demo.');
  },
};

export const demoClient: DataClient = {
  auth: authClient,
  bands: bandsClient,
  bandSongs: crudClient<Song>(store.songsCrud),
  bandSongLists: crudClient<SongList>(store.songListsCrud),
  bandSetlists: crudClient<Setlist>(store.setlistsCrud),
  bandRiders: crudClient<InputList>(store.ridersCrud),
  publicRiders: publicRidersClient,
  bandAttachments: bandAttachmentsClient,
  bandTrash: bandTrashClient,
  bandPressKits: crudClient<PressKit>(store.pressKitsCrud),
  bandPressKitImages: bandPressKitImagesClient,
  bandPressKitShares: bandPressKitSharesClient,
  publicPressKits: publicPressKitsClient,
  adminInvites: adminInvitesClient,
  adminUsers: adminUsersClient,
};
