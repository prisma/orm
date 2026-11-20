const denylist = ['$connect', '$disconnect', '$on', '$use', '$extends'] as const

export const itxClientDenyList = denylist as ReadonlyArray<string | symbol>

export type ITXClientDenyList = (typeof denylist)[number]
