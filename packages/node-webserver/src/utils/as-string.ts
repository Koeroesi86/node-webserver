/** a header value as one string: the values of a list are joined the way they are sent, an absent one is empty */
const asString = (value: unknown) => (Array.isArray(value) ? value.join(', ') : `${value ?? ''}`);

export default asString;
