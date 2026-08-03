# Syncer — Privacy Policy

_Last updated: 3 August 2026_

Syncer keeps video playback in step between people watching the same thing. To
do that it has to tell the other people in your room what your player is doing,
which means some information about what you are watching leaves your browser.
This policy says exactly what, where it goes, and who can see it.

## The server is yours

Syncer has no server of its own. It talks to a sync server whose address you
enter in the extension, and the address it ships with is
`http://127.0.0.1:3000` — your own machine. Until you point it somewhere else,
nothing leaves your computer.

If you enter the address of a server run by somebody else, that server's
operator can see everything listed below. Choose one you trust.

The extension's author does not operate a server, receives none of your data,
and has no way to see what you watch.

## What is sent to the sync server

Only while you are in a room, and only for the tab you are syncing:

- **The address (URL) of the page you are watching.** This is what lets the
  room follow you when you move to the next episode.
- **Playback state:** position in the video, whether it is playing, paused or
  buffering, playback speed, volume, and whether it is muted.
- **The room name** you created or joined.
- **On Spotify:** the track and playlist identifiers, track length and position.
- **Timestamps**, used to measure the clock difference between participants so
  positions line up.
- **A room token**, if you created the room, so you can reclaim it as host after
  a disconnection.

The server relays this to the other members of your room. Anyone in a room with
you can therefore see which page you are on and what your player is doing. Only
people who know the room name can join it.

Syncer does not send anything from tabs you are not syncing, and stops sending
anything at all when you leave the room.

## What is stored on your device

Kept locally, in the browser's extension storage:

- The sync server address you entered.
- The name of the room you are currently in, and the one before it.
- Room owner tokens, for rooms you created.
- Which tabs have an active session — cleared when you restart the browser.

You can clear all of it by removing the extension.

## What Syncer does not do

- No analytics, telemetry, crash reporting or advertising.
- No tracking of your browsing across sites; nothing is recorded outside the tab
  you have deliberately put in a room.
- Nothing is sold, rented or shared with third parties.
- No account, sign-in, email address or payment details.

## Permissions

Syncer requests access to all websites because you may want to sync a video on
any site. The access is used only to find the video element on the page you are
syncing and to control it.

## Changes

If this policy changes, the date at the top changes with it.

## Contact

Questions or requests: <syncer@zznixt.me>
