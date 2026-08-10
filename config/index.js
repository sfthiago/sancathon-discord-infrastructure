import serverConfig, { teams } from "./server.js";
import rolesConfig, {
  permissionProfiles,
  roleHierarchy,
  roles,
} from "./roles.js";
import channelsConfig, {
  categories,
  channels,
  forumTagSets,
} from "./channels.js";

export {
  categories,
  channels,
  channelsConfig,
  forumTagSets,
  permissionProfiles,
  roleHierarchy,
  roles,
  rolesConfig,
  serverConfig,
  teams,
};

export const config = {
  server: serverConfig,
  roles: rolesConfig,
  channels: channelsConfig,
};

export default config;
