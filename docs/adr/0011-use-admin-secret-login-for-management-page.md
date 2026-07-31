# Use admin secret login for the management page

The MVP management page will authenticate administrators with a configured admin secret and then issue a short-lived admin session for browser use. This avoids building a full administrator account system while still making bootstrap tasks usable without Postman or manual API calls. The management page exposure should be configurable so teams can restrict it to localhost or allow intranet access deliberately.
