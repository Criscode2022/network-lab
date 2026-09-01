import { eveChannel } from 'eve/channels/eve';
import { localDev, none, vercelOidc } from 'eve/channels/auth';

/**
 * Browser guests on the Angular canvas talk to this channel directly
 * (Vercel Eve host, or local :4010). Health stays public; session routes
 * admit anonymous callers via none() so the drawer can stream without OIDC.
 */
export default eveChannel({
  auth: [vercelOidc(), localDev(), none()],
  cors: true,
});
