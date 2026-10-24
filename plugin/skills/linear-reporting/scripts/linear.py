#!/usr/bin/env python3
"""Post Linear agent activities, update the session plan and links, or run raw GraphQL.

Reads LINEAR_ACCESS_TOKEN and LINEAR_AGENT_SESSION_ID from the environment. Standard library only.

  linear.py activity thought --body "Reading the recipe list code"
  linear.py activity thought --body "Running the tests" --ephemeral
  linear.py activity action --action "Opened PR" --parameter "#42" --result "draft"
  linear.py activity elicitation --body "..." --option "Approve=approve" --option "Change it=change"
  linear.py activity response --body "Spec ready for review: <url>"
  linear.py plan "completed:Research" "inProgress:Write the spec" "pending:Open the draft PR"
  linear.py link --label "PR #42" --url https://github.com/owner/repo/pull/42
  linear.py gql < request.json   # {"query": "...", "variables": {...}}
"""

import argparse
import json
import os
import sys
import urllib.request

API_URL = 'https://api.linear.app/graphql'
PLAN_STATUSES = {'pending', 'inProgress', 'completed', 'canceled'}


def graphql(query, variables):
    token = os.environ['LINEAR_ACCESS_TOKEN']
    request = urllib.request.Request(
        API_URL,
        data=json.dumps({'query': query, 'variables': variables}).encode(),
        headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {token}'},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        body = json.load(response)
    if body.get('errors'):
        sys.exit('Linear GraphQL error: ' + '; '.join(error['message'] for error in body['errors']))
    return body['data']


def session_id():
    return os.environ['LINEAR_AGENT_SESSION_ID']


def activity(args):
    if args.type == 'action':
        content = {'type': 'action', 'action': args.action, 'parameter': args.parameter or ''}
        if args.result:
            content['result'] = args.result
    else:
        content = {'type': args.type, 'body': args.body}
    payload = {'agentSessionId': session_id(), 'content': content}
    if args.ephemeral:
        payload['ephemeral'] = True
    if args.option:
        options = [dict(zip(('label', 'value'), option.split('=', 1), strict=True)) for option in args.option]
        payload['signal'] = 'select'
        payload['signalMetadata'] = {'options': options}
    graphql(
        'mutation ($input: AgentActivityCreateInput!) { agentActivityCreate(input: $input) { success } }',
        {'input': payload},
    )


def plan(args):
    items = []
    for item in args.items:
        status, content = item.split(':', 1)
        if status not in PLAN_STATUSES:
            sys.exit(f'Unknown plan status {status!r}; use one of {sorted(PLAN_STATUSES)}')
        items.append({'content': content, 'status': status})
    graphql(
        'mutation ($id: String!, $input: AgentSessionUpdateInput!) { agentSessionUpdate(id: $id, input: $input) { success } }',
        {'id': session_id(), 'input': {'plan': items}},
    )


def link(args):
    graphql(
        'mutation ($id: String!, $input: AgentSessionUpdateInput!) { agentSessionUpdate(id: $id, input: $input) { success } }',
        {'id': session_id(), 'input': {'addedExternalUrls': [{'label': args.label, 'url': args.url}]}},
    )


def raw(_args):
    request = json.load(sys.stdin)
    print(json.dumps(graphql(request['query'], request.get('variables', {})), indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(required=True)

    activity_parser = commands.add_parser('activity')
    activity_parser.add_argument('type', choices=['thought', 'action', 'elicitation', 'response', 'error'])
    activity_parser.add_argument('--body', default='')
    activity_parser.add_argument('--action')
    activity_parser.add_argument('--parameter')
    activity_parser.add_argument('--result')
    activity_parser.add_argument('--ephemeral', action='store_true')
    activity_parser.add_argument('--option', action='append', help='label=value; elicitation only')
    activity_parser.set_defaults(run=activity)

    plan_parser = commands.add_parser('plan')
    plan_parser.add_argument('items', nargs='+', help='status:content, in display order')
    plan_parser.set_defaults(run=plan)

    link_parser = commands.add_parser('link')
    link_parser.add_argument('--label', required=True)
    link_parser.add_argument('--url', required=True)
    link_parser.set_defaults(run=link)

    commands.add_parser('gql').set_defaults(run=raw)

    args = parser.parse_args()
    if getattr(args, 'type', None) in {'thought', 'elicitation', 'response', 'error'} and not args.body:
        parser.error('--body is required for this activity type')
    if getattr(args, 'option', None) and args.type != 'elicitation':
        parser.error('--option only applies to an elicitation')
    if getattr(args, 'ephemeral', False) and args.type not in {'thought', 'action'}:
        parser.error('only thought and action activities can be ephemeral')
    args.run(args)


if __name__ == '__main__':
    main()
