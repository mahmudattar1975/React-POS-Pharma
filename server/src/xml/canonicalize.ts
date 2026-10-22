// Canonicalizes invoice XML before hashing it for the ZATCA digital signature.
//
// This is NOT a general-purpose W3C XML C14N implementation - no npm package for that turned out
// to be usable here (the only one available, `xml-c14n`, hasn't published a release since its
// 0.0.6, and pulling in a bigger XML-processing dependency for one transform felt like more risk
// than benefit for a project that hasn't been validated against ZATCA's live endpoint anyway).
// What this does is a practical stand-in that's correct FOR XML THIS PROJECT GENERATES ITSELF:
// buildInvoiceXml.ts already serializes deterministically (fixed element/attribute order, no
// pretty-printing, no comments/PIs/CDATA), so the one remaining C14N-mandated normalization that
// matters is converting empty-element self-closing tags (`<tag/>`) to explicit open/close pairs
// (`<tag></tag>`), which real C14N requires and xmlbuilder2's default serializer doesn't produce.
//
// VERIFY BEFORE REAL ONBOARDING: ZATCA's backend recomputes the invoice hash on its end and
// compares it to the one submitted. If ZATCA's recomputation uses full W3C C14N and this
// approximation diverges from it in some case not exercised here, submissions will fail hash
// verification. Test this specifically once simulation credentials are available - see
// server/README.md - before assuming it's correct.
export function canonicalizeXml(xml: string): string {
  return xml.replace(/<([a-zA-Z0-9:_-]+)((?:\s+[a-zA-Z0-9:_-]+="[^"]*")*)\s*\/>/g, '<$1$2></$1>');
}
