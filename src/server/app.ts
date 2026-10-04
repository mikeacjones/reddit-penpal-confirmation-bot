import { Hono } from 'hono';
import { cron } from './routes/cron';
import { forms } from './routes/forms';
import { menu } from './routes/menu';
import { triggers } from './routes/triggers';

export const app = new Hono();
const internal = new Hono();

internal.route('/triggers', triggers);
internal.route('/cron', cron);
internal.route('/menu', menu);
internal.route('/form', forms);

app.route('/internal', internal);
