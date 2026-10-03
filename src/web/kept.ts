/** What a viewer chose, kept in this browser where it can be: a private window or blocked storage keeps nothing. */
export const kept = (key: string) => ({
  read: (): string | null => {
    try {
      return window.localStorage.getItem(key)
    } catch {
      return null
    }
  },
  write: (value: string) => {
    try {
      window.localStorage.setItem(key, value)
    } catch {
      return
    }
  },
})
