/** Exact wire integers are authoritative; BCHN reference JSON keeps its existing conversion. */
export const satoshis = (output: any): bigint => output.satoshis !== undefined ? BigInt(output.satoshis) : BigInt(Math.round(output.value * 1e8));
