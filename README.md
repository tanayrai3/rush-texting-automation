# Rush Texting Automation

I'm the rush chair for my fraternity (Phi Sigma Kappa, Alpha Deuteron Chapter at UIUC). Every fall we run about four weeks of rush with four or five events a week. The old process was five guys splitting up a list and texting their slice by hand, copying numbers out of a Google Sheet one at a time. I wanted to automate that without it turning into an obvious mass blast, and without using anyone's personal number to do it.

## What it needed to do

- No personal phone numbers involved anywhere
- Texts had to feel like a real person sent them: first name filled in, signed by whoever's name is on the message
- No leftover "Reply STOP" type text that gives away it's automated
- Had to stay synced with our Google Form as new people sign up, no manual copying of numbers
- People can text back, and we reply ourselves, not through any automated system

## Decisions I made

I went with one shared Twilio number instead of giving each brother their own, since it's cheaper and a lot simpler to manage. The sender's name just gets typed into the message itself. Replies get read and answered from Twilio's own console instead of getting forwarded to anyone's personal phone. And sending is manual, triggered from a button inside the Sheet, not fully automatic on a timer, so someone always reads the message before it actually goes out.

## How it's built

A Google Form collects sign ups and feeds into a Google Sheet. I wrote a Google Apps Script attached to that Sheet that adds a custom menu to it. Clicking "Send Event Text" opens a small popup where you type the message, and it goes out through Twilio's API to everyone in the sheet who hasn't already gotten that event's text. Replies come back into Twilio directly, not through my script, and get checked manually in the console.

## The files

`Code.gs` has all the actual logic: storing Twilio credentials, validating phone numbers, the send loop, the menu setup. `SendDialog.html` is just the popup that shows up when you click Send Event Text.

Both get pasted into whatever Google Sheet's Apps Script editor you're using. One thing that tripped me up early on: every sheet has its own separate Apps Script project, even if you paste identical code into it, so I have to re-enter the Twilio credentials on each new sheet I set up. The column headers also need to say exactly "First Name" and "Phone Number," or the script can't find them. I ended up adding some whitespace trimming to the header matching because Google Forms sometimes sneaks in invisible trailing spaces on auto generated question titles, which broke things the first time.

## How sending actually works

Every time you hit send, the script:

1. Finds the First Name and Phone Number columns
2. Adds a column called "Sent: [event name]" if it doesn't exist yet, so it can track who's already gotten that specific event's message
3. Builds a list of people already texted for that event based on phone number, not row number, since people sometimes fill out the form twice by accident
4. Goes row by row, checks the phone number is real, skips anyone already texted or flagged as a duplicate, sends the text, then marks that row as sent right after

Marking the row sent immediately after the send succeeds, and not before, is what makes it safe to stop the script partway through and just run it again. Nothing gets double texted, because a row only ever gets marked once Twilio actually confirms the message went out.

## Filtering out fake numbers

Before using this on real recruits, I tested it on the whole house, and some guys put in joke numbers on purpose: letters, "911," stuff like that. So the phone validation rejects anything that isn't ten digits, rejects area codes starting with 0 or 1 since those aren't real, rejects repeated digit numbers like 1111111111, and rejects the obvious 1234567890 pattern. Anything that fails shows up in a separate "failed" list in the summary so it's clear what didn't send and why.

## Getting Twilio actually working

This took a lot longer than writing the code did. I started on a Twilio trial account, which only lets you text numbers you've manually verified and adds a "sent from a trial account" line to every message, so neither of those work for real use. I bought a toll free number, which needed something called Toll-Free Verification before it could send anything at all. That's different from A2P 10DLC, which is the process for regular local numbers instead. I had to describe the business, the use case, give a sample message, and explain how people opt in. That got approved. Then I had to upgrade the account with a real payment method, which triggered an automatic fraud review since the account got flagged for a mismatch between where I signed up and where I was billing from. I answered their questions honestly, explained the mismatch, and it eventually got approved.

## What it costs

Twilio charges per message segment, roughly $0.0079 each. A text counts as one segment if it's under 160 characters and doesn't have anything like emojis in it. Go over 160 and it splits into multiple segments of 153 characters each, so cost climbs faster than you'd expect if you're not careful about length, especially since the first name field changes how long each message actually is. For a full rush cycle sending somewhere around 15 to 20 thousand texts total, I'm estimating roughly 150 to 220 dollars.

## A bug I ran into

By default, the number had Twilio's demo auto reply turned on, so anyone who texted back got a generic "thanks for the message, reply STOP to unsubscribe" response instead of silence. That setting lives on the phone number itself, not in my code, so I had to go find it in the number's messaging configuration and turn it off.

## Replying to people

Twilio doesn't give you a real inbox like a texting app, it's just a log of every message. To read what someone sent, I search the logs by their number. To reply, there's a compose tool where you manually set who it's from, who it's to, and type the message. It works fine for what we need, just not as smooth as an actual chat interface.

## Where this stands right now

Toll free verification is approved, the account is upgraded, the auto reply bug is fixed, and I tested it successfully on about 60 guys in the house before trusting it with real recruits. Next step is pointing it at the actual sign up sheet and doing a real send once rush starts.

## A note on security

The Twilio Auth Token is a real secret and never goes in this repo or anywhere public. It only ever gets typed into a prompt in the Sheet itself, which stores it in Google's private script storage, not in any file. Payment details were only ever handled directly inside Twilio's own support system, never written down or stored anywhere in this project.
