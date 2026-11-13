// Counts page views for Admin > Analytics and "sort by traffic" in Admin > Page content.
// Vendor pages count their own view (with the vendor) in vendor-page.ts; dashboards aren't counted.
import { track } from './api';
if (!/^\/(vendor\/|back-end|vendor-dashboard)/.test(location.pathname)) track(null, 'page_view');
