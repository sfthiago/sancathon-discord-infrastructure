export const teams = [
  { number: 1, key: "team01", roleKey: "team01" },
  { number: 2, key: "team02", roleKey: "team02" },
  { number: 3, key: "team03", roleKey: "team03" },
  { number: 4, key: "team04", roleKey: "team04" },
  { number: 5, key: "team05", roleKey: "team05" },
  { number: 6, key: "team06", roleKey: "team06" },
  { number: 7, key: "team07", roleKey: "team07" },
  { number: 8, key: "team08", roleKey: "team08" },
  { number: 9, key: "team09", roleKey: "team09" },
  { number: 10, key: "team10", roleKey: "team10" },
];

export const serverConfig = {
  key: "sancathon2026",
  expectedGuildName: "Sancathon 2026 | SIEEL",
  environment: {
    tokenVariable: "DISCORD_TOKEN",
    guildIdVariable: "GUILD_ID",
  },
  stateFile: ".state/discord-resources.json",
  reportsDirectory: "reports",
  features: {
    stageEnabled: false,
    eventCategoryVisibleToParticipants: false,
  },
  teams,
  matching: {
    unicodeNormalization: "NFKC",
    caseInsensitive: true,
    trimWhitespace: true,
    collapseWhitespace: true,
    fuzzyMatching: false,
  },
  safety: {
    deleteRoles: false,
    deleteChannels: false,
    deleteCategories: false,
    deleteMembers: false,
    preserveUnmanagedOverwrites: true,
    preserveUnmanagedForumTags: true,
  },
};

export default serverConfig;
