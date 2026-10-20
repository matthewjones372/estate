# Estate

Estate shows the state of a set of services, across their environments, on one page that updates as things change.

## Language

**Service**:
One deployable thing in the catalog, seen in one environment at a time.
_Avoid_: App, application

**Service page**:
The page for one service in the chosen environment: what's happening, what changed, where to look, then its load, logs and pods.
_Avoid_: App view, service view

**Error**:
A service's log line that Estate counts as an error: by its level when it has one, else by the catalog's error pattern for that service. One definition, whichever system the lines come from.
_Avoid_: Exception, failure

**Error group**:
Errors whose messages are the same once times, ids, quoted values and numbers are taken out: one fault, one row.
_Avoid_: Error type, error kind
