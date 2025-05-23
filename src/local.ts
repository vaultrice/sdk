const LOCAL_ID_NAME = 'NON_LOCAL_STORAGE_LOCAL_ID'

export const getLocalId = () : string | null => {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage.getItem(LOCAL_ID_NAME)
  }
  return null
}

export const setLocalId = (id: string) => {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(LOCAL_ID_NAME, id)
  }
}
