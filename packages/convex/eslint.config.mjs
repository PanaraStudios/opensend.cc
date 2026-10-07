import nextTs from "eslint-config-next/typescript"
export default [...nextTs, { ignores: ["dist/**", "**/_generated/**"] }]
