Output docs/demo.gif

Set Shell "bash"
Set FontSize 14
Set Width 900
Set Height 530
Set Theme "Dracula"
Set Padding 24
Set TypingSpeed 50ms
Set PlaybackSpeed 1

# Hidden setup: wire up local CLI and put the export in /tmp/demo
Hide
Type "export PATH=/Users/dgalnykin/Projects/Claude_controlled/projects/depress/node_modules/.bin:$PATH"
Enter
Type "mkdir -p /tmp/depress-demo-session && cd /tmp/depress-demo-session && rm -rf my-blog && cp /tmp/demo-export.xml export.xml"
Enter
Sleep 1s
Show

Type "# Migrate a WordPress site to Astro + Keystatic in one command"
Enter
Sleep 700ms

Type "depress migrate --input export.xml --output ./my-blog"
Sleep 900ms
Enter
Sleep 25s

Type "ls my-blog/"
Sleep 200ms
Enter
Sleep 600ms

Type "cat my-blog/redirects.json | head -12"
Sleep 200ms
Enter
Sleep 800ms

Type "ls my-blog/src/data/post/"
Sleep 200ms
Enter
Sleep 600ms

Sleep 3s
