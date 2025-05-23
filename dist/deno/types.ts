export type ValueType = string | number | boolean
export type SetReturnType = { expiresAt: number }
export type ItemType<T = ValueType> = { value: T } & SetReturnType
export type ItemsType = Record<string, ItemType>
export type SetItemsType = Record<string, SetReturnType>

type JSONObjInner =
  | string
  | number
  | boolean
  | null
  | undefined
  | { [key: string]: JSONObjInner }
  | JSONObjInner[]
export type JSONObj = { [key: string]: JSONObjInner }
