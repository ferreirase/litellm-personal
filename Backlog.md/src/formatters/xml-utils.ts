export function escapeXml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

export function cdata(s: string): string {
	// Escape any occurrence of ]]> inside CDATA content
	return `<![CDATA[${s.replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;
}
