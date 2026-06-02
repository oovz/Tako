export const MOCK_PUBLUS_KEYS = {
  key1: '77fb2c670460a4daeb0463c40976806a63750720ceb768cf43031fca8f3eb5e2',
  key2: '49840499d31b5b7bffadf76a48b1308b25f6c2ed154d91f66abc7764ec9029d2',
  key3: 'f7cccf3b883fb488f842ec6afc7129a5ded56bd98143c6bfd6951a958f2843e1',
} as const

export const MOCK_PUBLUS_CONFIG = {
  configuration: {
    'file-name-version': '1.0',
    keys: MOCK_PUBLUS_KEYS,
    contents: [
      {
        file: 'item/xhtml/p-cover.xhtml',
        index: 1,
        'original-file-path': 'item/xhtml/p-cover.xhtml',
        type: 'png',
      },
      {
        file: 'item/xhtml/p-000.xhtml',
        index: 2,
        'original-file-path': 'item/xhtml/p-000.xhtml',
        type: 'png',
      },
    ],
  },
  'item/xhtml/p-cover.xhtml': {
    FileLinkInfo: {
      PageLinkInfoList: [{
        Page: {
          No: 0,
          NS: 492551829,
          PS: 1062163659,
          RS: 1425211224,
          BlockWidth: 32,
          BlockHeight: 32,
        },
      }],
    },
  },
  'item/xhtml/p-000.xhtml': {
    FileLinkInfo: {
      PageLinkInfoList: [{
        Page: {
          No: 0,
          NS: 3426648385,
          PS: 2558111233,
          RS: 4130047053,
          BlockWidth: 32,
          BlockHeight: 32,
        },
      }],
    },
  },
} as const

export const MOCK_PUBLUS_IMAGE_PATHS = [
  '/9_hash/epub/book_contents/c958/item/xhtml/p-cover.xhtml/106858d4a8cf8d2165.png',
  '/9_hash/epub/book_contents/c958/item/xhtml/p-000.xhtml/1016cec4222ae82a25.png',
] as const
