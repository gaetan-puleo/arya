// Launch the Expo CLI for native-build commands (run:android/ios), ensuring
// ANDROID_HOME points at a real SDK. Respects a pre-set ANDROID_HOME; otherwise
// falls back to the standard ~/Android/Sdk when that directory exists.
// (deno task's shell has no `${VAR:-default}` expansion, so this lives in code.)
//
// Expo/Metro runs under NODE (npx), not `deno run npm:@expo/cli`: the latter's
// --node-modules-dir materialises a parallel `.deno` store that duplicates React
// (two instances break NativeWind's cssInterop, so className styles silently stop
// applying), and `--node-modules-dir=none` can't resolve the project's
// metro.config deps. node uses the single npm node_modules directly.
// See memory: companion-nativewind-duplicate-react.

const home = Deno.env.get('HOME') ?? Deno.env.get('USERPROFILE') ?? '';

if (!Deno.env.get('ANDROID_HOME') && home) {
  const sdk = `${home}/Android/Sdk`;
  try {
    if (Deno.statSync(sdk).isDirectory) {
      Deno.env.set('ANDROID_HOME', sdk);
      if (!Deno.env.get('ANDROID_SDK_ROOT')) Deno.env.set('ANDROID_SDK_ROOT', sdk);
      const extra = [`${sdk}/platform-tools`, `${sdk}/cmdline-tools/latest/bin`, `${sdk}/emulator`].join(':');
      Deno.env.set('PATH', `${Deno.env.get('PATH') ?? ''}:${extra}`);
      console.error(`[expo-launch] ANDROID_HOME not set — using ${sdk}`);
    }
  } catch {
    // No SDK at the default path; let the Expo CLI report the actionable error.
  }
}

const child = new Deno.Command('npx', {
  args: ['expo', ...Deno.args],
  stdin: 'inherit',
  stdout: 'inherit',
  stderr: 'inherit',
}).spawn();

const status = await child.status;
Deno.exit(status.code);
