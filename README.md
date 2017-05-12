# BattleSnake!

![Screenshot](/screenshot.png)

## Setup and Run

```
npm install
node .
```

## Algorithm

This snake is a significantly modified version of the 'Battle Constrictor' bounty snake that I co-wrote for BattleSnake 2017. This version should be a fair bit smarter because it saw continued development; whereas the original was rushed to completion for the event.

It uses the A* (A-star) search algorithm to find the best paths to food or nodes adjacent to the snake's tail. Path finding employs a heuristic to avoid walls and enemy snakes. Paths are weighted according to how hungry the snake is, how far away food is and whether or not the goal provides a path back to the snake's tail (i.e. a valid subsequent move). If no valid path to food or the snake's tail can be found, the AI will move the snake in the direction with the most open space.