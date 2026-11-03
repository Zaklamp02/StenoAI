import { test, expect } from '../fixtures/electron';
import { readUserConfig } from '../fixtures/user-config';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';

/**
 * T2 -- the Obsidian vault folder must be a vault's root. Sync adds its own
 * StenoAI/ folder, so choosing <vault>/StenoAI nested a second copy of every
 * note under StenoAI/StenoAI. The real backend refuses a folder inside a vault
 * (an ancestor holds .obsidian), names the root instead, and leaves config.json
 * untouched; the root itself is accepted.
 */

type Bridge = {
  settings: {
    setObsidianVaultPath: (p: string) => Promise<{ success?: boolean; error?: string }>;
  };
};
type StenoWindow = Window & { stenoai: Bridge };

test('a folder inside an Obsidian vault is refused; the vault root is accepted', async ({
  launchApp,
  userDataDir,
}) => {
  const vault = path.join(userDataDir, 'vault');
  mkdirSync(path.join(vault, '.obsidian'), { recursive: true });
  const nested = path.join(vault, 'StenoAI');
  const { page } = await launchApp();

  const refused = await page.evaluate(
    (p) => (window as unknown as StenoWindow).stenoai.settings.setObsidianVaultPath(p),
    nested,
  );
  expect(refused.success).toBe(false);
  expect(refused.error).toContain(vault);
  expect(readUserConfig(userDataDir).obsidian_vault_path ?? '').toBe('');
  expect(existsSync(nested)).toBe(false);

  const accepted = await page.evaluate(
    (p) => (window as unknown as StenoWindow).stenoai.settings.setObsidianVaultPath(p),
    vault,
  );
  expect(accepted.success).toBe(true);
  await expect.poll(() => readUserConfig(userDataDir).obsidian_vault_path).toBe(vault);
});
