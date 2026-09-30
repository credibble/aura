declare module "@metamask/jazzicon" {
  /** Renders a deterministic Jazzicon identicon into a detached container element. */
  function jazzicon(diameter: number, seed: number): HTMLElement;
  export default jazzicon;
}
