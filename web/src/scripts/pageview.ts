// Counts views of public content pages (used for "sort by traffic" in Admin > Page content).
import { track } from './api';
if (/^\/([a-z]{2}\/|categories\/|blog\/)/.test(location.pathname) && !/^\/vendor/.test(location.pathname)) track(null, 'page_view');
