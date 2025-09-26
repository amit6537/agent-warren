Step 1: Create a .gitignore File
This is a crucial first step to ensure you don't accidentally upload your secret API key or other unnecessary files to a public repository.

In your server directory, create a new file named .gitignore.

Copy and paste the following content into the .gitignore file:

# Dependencies
/node_modules

# Mastra build output
/.mastra

# Environment variables (contains your secret API key)
.env

# Local Database File
mastra.db
mastra.db-journal
This tells Git to ignore these files and folders.

Step 2: Create a New Repository on GitHub
Go to github.com/new in your browser.

Give your repository a name (e.g., berkshire-hathaway-agent).

Leave it as a Public repository.

Important: Do not check any of the boxes to add a README, license, or .gitignore file. We have already created these locally.

Click the Create repository button.

Step 3: Push Your Code from the Terminal
After creating the repository, GitHub will show you a page with some commands. We'll use those now.

Open your terminal and make sure you are in your server directory. Run the following commands one by one.

Initialize Git

Bash

git init -b main
Add all your files

Bash

git add .
Make your first commit (a snapshot of your code)

Bash

git commit -m "Initial commit: Berkshire Hathaway RAG Agent"
Connect your local folder to GitHub

Go to your new repository's page on GitHub and copy the URL. It will look like https://github.com/your-username/your-repo-name.git.

Run this command, replacing the URL with your own:

Bash

git remote add origin https://github.com/your-username/your-repo-name.git
Push your code to GitHub

Bash

git push -u origin main