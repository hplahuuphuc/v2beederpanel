const express = require('express');
const router = express.Router();
const { db } = require('../../handlers/db.js');
const { isUserAuthorizedForContainer } = require('../../utils/authHelper');
const { createFile } = require('../../utils/fileHelper');
const { loadPlugins } = require('../../plugins/loadPls.js');
const path = require('path');

const plugins = loadPlugins(path.join(__dirname, '../../plugins'));

/*
|--------------------------------------------------------------------------
| POST - Create File
|--------------------------------------------------------------------------
*/
router.post("/instance/:id/files/create/:filename", async (req, res) => {
    try {

        // 🔐 Auth check
        if (!req.user) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const { id } = req.params;
        const filename = decodeURIComponent(req.params.filename);
        const { content } = req.body;

        if (!filename) {
            return res.status(400).json({ error: 'Filename is required' });
        }

        // 📦 Get instance
        const instance = await db.get(id + '_instance');
        if (!instance) {
            return res.status(404).json({ error: 'Instance not found' });
        }

        // 🔐 Authorization check
        const isAuthorized = await isUserAuthorizedForContainer(
            req.user.userId,
            instance.Id
        );

        if (!isAuthorized) {
            return res.status(403).json({ error: 'Unauthorized access to this instance.' });
        }

        // ⛔ Suspended check
        if (instance.suspended === true) {
            return res.status(403).json({ error: 'Instance is suspended' });
        }

        // 🖥 Node config check
        if (!instance.Node || !instance.Node.address || !instance.Node.port) {
            return res.status(500).json({ error: 'Invalid instance node configuration' });
        }

        // 📁 Create file
        const result = await createFile(
            instance,
            filename,
            content || '',
            req.query.path || '/'
        );

        return res.json(result || { message: 'File created successfully' });

    } catch (error) {
        console.error("Create file error:", error);

        return res.status(500).json({
            error: error.message || 'Failed to communicate with node.'
        });
    }
});


/*
|--------------------------------------------------------------------------
| GET - Render Create File Page
|--------------------------------------------------------------------------
*/
router.get("/instance/:id/files/create", async (req, res) => {
    try {

        if (!req.user) {
            return res.redirect('/');
        }

        const { id } = req.params;
        if (!id) {
            return res.redirect('../instances');
        }

        const instance = await db.get(id + '_instance');
        if (!instance) {
            return res.status(404).send('Instance not found');
        }

        const isAuthorized = await isUserAuthorizedForContainer(
            req.user.userId,
            instance.Id
        );

        if (!isAuthorized) {
            return res.status(403).send('Unauthorized access to this instance.');
        }

        if (instance.suspended === true) {
            return res.redirect('../../instances?err=SUSPENDED');
        }

        if (!instance.VolumeId) {
            return res.redirect('../instances');
        }

        const allPluginData = Object.values(plugins).map(plugin => plugin.config);

        return res.render('instance/createFile', {
            req,
            user: req.user,
            name: await db.get('name') || 'HydraPanel',
            logo: await db.get('logo') || false,
            addons: {
                plugins: allPluginData
            }
        });

    } catch (error) {
        console.error("Render create page error:", error);
        return res.status(500).send('Internal server error');
    }
});

module.exports = router;