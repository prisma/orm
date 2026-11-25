type Spaced = "a  b";
type Template = `x  ${string}  y`;
declare const quoted: 'c	d';
export { Spaced, Template, quoted };
type Commented = {
  /** it's   a comment */
  readonly a:   "x  y";
};
export { Commented };
