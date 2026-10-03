/** An object without its undefined properties, typed as optional ones, for `exactOptionalPropertyTypes`. */
type Required<T> = { [K in keyof T as undefined extends T[K] ? never : K]: T[K] }
type Optional<T> = { [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined> }

export const compact = <const T extends object>(value: T): Required<T> & Optional<T> =>
  Object.fromEntries(Object.entries(value).filter(([, each]) => each !== undefined)) as Required<T> & Optional<T>
