import { defineConfig } from 'wxt';

const publicKey =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAn6pRg2l89A8IT6xdZKhSkcnbUbbk5yT+P8vzIjDu9hyOklmXJoDi/mTPXd7ezmbBAERfXlTL6cv2sBVOgwI+y/VHh6MUaLiiWkoSZQez+FM8gb4la5i/xljPauEFsqZ+AtQ3mnvdzShG19RrsrlL0SdSC1qS0mSQekncFkELMuHmV3RUxf5xkuakuUHELfbfa2d2K+2kYatstRNuqY6FKygvUS/GEydQqbvdd4K/DBkEnTJARtIVQ3zgOigjZ66nqj6QLBhUYjhYatzBSPDhUiQg9fYW2t0Xxw249WWQPbMIZRCn99CMi+Z5LDiHPXZ8RDG/x+3TdufqpthQ6fuoqQIDAQAB';

export default defineConfig({
  imports: false,
  manifestVersion: 3,
  outDirTemplate: '{{browser}}',
  manifest: {
    name: 'Sifer',
    description: 'Lets Sifer Motion read the page under the orb.',
    key: publicKey,
    minimum_chrome_version: '120',
    permissions: ['storage', 'tabs', 'alarms'],
    host_permissions: ['<all_urls>'],
    action: { default_title: 'Sifer' },
  },
});
