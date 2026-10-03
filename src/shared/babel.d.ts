/** Babel's presets ship without types; Estate passes them to Babel and nothing else. */
declare module "babel-preset-solid" {
  const preset: object
  export default preset
}
declare module "@babel/preset-typescript" {
  const preset: object
  export default preset
}
