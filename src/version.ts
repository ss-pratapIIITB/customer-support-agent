export const version = '1.0.0';
export const build = {
  commit: process.env.GIT_SHA ?? 'local',
  builtAt: process.env.BUILD_TIME ?? null,
};
