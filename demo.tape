Output docs/demo.gif

Set Shell "bash"
Set FontSize 14
Set Width 900
Set Height 530
Set Theme "Dracula"
Set Padding 24
Set TypingSpeed 50ms
Set PlaybackSpeed 1

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
