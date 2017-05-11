const aStar = require('./a-star');

const SEARCH_TIMEOUT = 50;

let state = {};

// Handle start requests
module.exports.start = function(req, res) {
  state = req.body;

  // Response data
  var data = {
    color: "#222222",
    name: "Come Slither",
    head_url: "http://www.placecage.com/c/200/200", // optional, but encouraged!
    taunt: "START",
  };

  return res.json(data);
}

// Handle move requests
module.exports.move = function(req, res) {
  state = req.body;

  let ourSnake = getSnake(state);
  let ourHead  = getHeadNode(ourSnake);
  let ourTail  = getTailNode(ourSnake);

  let result;
  let results = [];

  // seek out food
  for (let i = 0; i < state.food.length; i++) {
    result = aStarSearch(state, ourHead, [state.food[i]]);
    if (result.status != 'success') continue;
    result.goal = 'FOOD';

    // get hungrier as we lose life
    result.cost -= Math.round(100 - ourSnake.health_points);

    // get hungrier if food is further away
    result.cost -= distance(state.food[i], ourHead);

    results.push(result);
  }

  // seek nodes adjacent to our tail and including our tail (unless growing)
  let tailTargets = validNeighbors(state, ourTail);
  if (!isGrowing(ourSnake)) tailTargets.push(ourTail);
  for (let i = 0; i < tailTargets.length; i++) {
    result = aStarSearch(state, ourHead, [tailTargets[i]]);
    if (result.status != 'success') continue;
    result.goal = 'TAIL';
    results.push(result);
  }

  // don't chase food if we can't fit into path
  results = results.filter((result) => {
    if (result.goal == 'TAIL') return true;
    let spaceSize = getSpaceSize(state, result.path[1]);
    return spaceSize > ourSnake.coords.length;
  });

  // heavily penalize paths with no path back to our tail
  for (let i = 0; i < results.length; i++) {
    let path = results[i].path;
    if (!hasPathToTail(state, path[path.length - 1], ourSnake)) {
      results[i].cost += 1000;
    }
  }

  // if we found paths to goals, pick cheapest one
  if (results.length) {
    results.sort((a, b) => {
      return a.cost - b.cost;
    });
    return moveResponse(
      res,
      direction(ourHead, results[0].path[1]),
      'A* BEST PATH TO ' + results[0].goal
    );
  }

  // no best moves, pick the direction that has the most open space
  let moves = [];
  let headNeighbors = validNeighbors(state, ourHead);
  for (let i = 0; i < headNeighbors.length; i++) {
    let neighbor = headNeighbors[i];
    moves.push({
      node: neighbor,
      direction: direction(ourHead, neighbor),
      spaceSize: getSpaceSize(state, neighbor),
      wallCost: getWallCost(state, neighbor),
      isNextMove: isPossibleNextMove(state, getOtherSnakes(state), neighbor)
    });
  }
  moves.sort((a, b) => {
    // avoid nodes enemy snakes might move into
    if (a.spaceSize == b.spaceSize && a.isNextMove != b.isNextMove) {
      return a.isNextMove - b.isNextMove;
    }

    // don't cut off escape routes
    if (a.spaceSize == b.spaceSize) {
      return a.wallCost - b.wallCost;
    }

    return b.spaceSize - a.spaceSize;
  });
  if (moves.length) {
    return moveResponse(
      res,
      direction(ourHead, moves[0].node),
      'NO PATH TO GOAL, LARGEST SPACE'
    );
  }

  // no valid moves
  return moveResponse(res, 'up', 'FML');
}

function moveResponse(res, move, taunt) {
  taunt = taunt + ' ' + move;
  return res.json({move, taunt});
}

function getSpaceSize(state, node) {
  let validNodes = [node];
  let seenNodes  = {};
  seenNodes[node.toString()] = true;

  for (let i = 0; i < validNodes.length; i++) {
    let neighbors = validNeighbors(state, validNodes[i]);
    for (let j = 0; j < neighbors.length; j++) {
      if (!seenNodes[neighbors[j].toString()]) {
        seenNodes[neighbors[j].toString()] = true;
        validNodes.push(neighbors[j]);
      }
    }
  }

  return validNodes.length;
}

function hasPathToTail(state, startNode, snake) {
  let snakeTail = getTailNode(snake);
  let result = aStarSearch(state, startNode, validNeighbors(state, snakeTail));
  return result.status == 'success';
}

function getHeadNode(snake) {
  return snake.coords.slice(0,1)[0].slice();
}

function getTailNode(snake) {
  return snake.coords.slice(-1)[0].slice();
}

function getSnake(state, snakeId) {
  if (!snakeId) snakeId = state.you;
  for (let snake of state.snakes) {
    if (snake.id == snakeId) return snake;
  }
}

function getOtherSnakes(state, snakeId) {
  if (!snakeId) snakeId = state.you;
  return state.snakes.filter((snake) => {
    return snake.id != snakeId;
  });
}

function getHurtfulSnakes(state, snakeId) {
  if (!snakeId) snakeId = state.you;
  let subjectSnake = getSnake(state, snakeId);
  return state.snakes.filter((snake) => {
    return snake.id != snakeId && snake.coords.length >= subjectSnake.coords.length;
  });
}

function isSameNode(a, b) {
  return a[0] === b[0] && a[1] === b[1];
}

function isInNodes(node, nodes) {
  for (let i = 0; i < nodes.length; i++) {
    if (node[0] === nodes[i][0] && node[1] === nodes[i][1]) return true;
  }
  return false;
}

function isAdjacent(a, b) {
    if (a[0] == b[0]) {
      return a[1] == b[1]-1 || a[1] == b[1]+1
    } else if (a[1] == b[1]) {
      return a[0] == b[0]-1 || a[0] == b[0]+1
    }
    return false;
}

function isSnake(state, node) {
  for (let i = 0; i < state.snakes.length; i++) {
    if (isInNodes(node, state.snakes[i].coords)) {
      return true;
    }
  }
  return false;
}

function isFood(state, node) {
  return isInNodes(node, state.food);
}

function isWall(state, node) {
  return node[0] < 0 || node[0] >= state.width || node[1] < 0 || node[1] >= state.height;
}

function distance(a, b) {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
}

function neighbors(node) {
  return [
    [node[0] - 1, node[1]],
    [node[0] + 1, node[1]],
    [node[0], node[1] - 1],
    [node[0], node[1] + 1]
  ];
}

function validNeighbors(state, node) {
  let ourSnake = getSnake(state);
  return neighbors(node).filter((node) => {
    // walls are not valid
    if (isWall(state, node)) return false;

    // don't consider food nodes adjacent to the head of a bigger snake
    if (isFood(state, node) && isPossibleNextMove(state, getHurtfulSnakes(state), node)) return false;

    // don't consider occupied nodes unless they are moving tails
    if (isSnake(state, node) && !isMovingTail(state, node)) return false;

    // looks valid
    return true;
  });
}

function isMovingTail(state, node) {
  for (let i = 0; i < state.snakes.length; i++) {
    let coords = state.snakes[i].coords;

    // if it's not the tail node, consider next snake
    if (!isSameNode(node, coords[coords.length - 1])) continue;

    // if snake is growing, tail won't move
    if (isGrowing(state.snakes[i])) return false;

    // must be a moving tail
    return true;
  }
  return false;
}

function isGrowing(snake) {
  let coords = snake.coords;
  return isSameNode(coords[coords.length - 1], coords[coords.length - 2]);
}

function isPossibleNextMove(state, snakes, node) {
  return snakes.some((snake) => {
    return isInNodes(node, neighbors(getHeadNode(snake)));
  });
}

function heuristic(state, node) {
  // cost goes up if node is close to a wall because that limits escape routes
  let wallCost = getWallCost(state, node);

  let enemyCost = 0;
  if (isPossibleNextMove(state, getHurtfulSnakes(state), node)) {
    enemyCost = 100;
  }
  return wallCost + enemyCost;
}

function direction(fromNode, toNode) {
  if (fromNode[1] > toNode[1]) return 'up';
  if (fromNode[1] < toNode[1]) return 'down';
  if (fromNode[0] > toNode[0]) return 'left';
  if (fromNode[0] < toNode[0]) return 'right';
}

function aStarSearch(state, startNode, targets) {
  let options = {
    start: startNode,
    isEnd: (node) => {
      return isInNodes(node, targets);
    },
    neighbor: (node) => validNeighbors(state, node),
    distance: distance,
    heuristic: (node) => heuristic(state, node),
    timeout: SEARCH_TIMEOUT
  }
  return aStar(options);
}

function getWallCost(state, node) {
  let halfWidth  = (state.width - 1) / 2;
  let halfHeight = (state.height - 1) / 2;
  let deviation  = [
    Math.abs(node[0] - halfWidth)  / halfWidth,
    Math.abs(node[1] - halfHeight) / halfHeight
  ];

  return Math.round(Math.max(...deviation) * ((halfWidth + halfHeight) / 4));
}

function getOccupiedNodes(snakes) {
  let nodes = [];
  for (let snake of snakes) {
    for (let i = 0; i < snake.coords.length; i++) {
      nodes.push(snake.coords[i]);
    }
  }
  return nodes;
}