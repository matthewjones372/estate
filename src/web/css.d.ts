declare module "*.css"
declare module "*.woff2" {
  /** Where the bundle serves the font. */
  const url: string
  export default url
}
